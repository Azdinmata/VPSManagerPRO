#!/bin/bash
# VPSManagerPRO limiter version 2026-05-03.1
DB_FILE="/etc/vpsmanagerpro/users.db"
BW_DIR="/etc/vpsmanagerpro/bandwidth"
PID_DIR="$BW_DIR/pidtrack"
BANNER_DIR="/etc/vpsmanagerpro/banners"
SCAN_INTERVAL=30

mkdir -p "$BW_DIR" "$PID_DIR"
shopt -s nullglob

write_banner_if_changed() {
    local user="$1"
    local content="$2"
    local banner_file="$BANNER_DIR/${user}.txt"
    local tmp_file="${banner_file}.tmp"

    printf "%s" "$content" > "$tmp_file"
    if ! cmp -s "$tmp_file" "$banner_file" 2>/dev/null; then
        mv "$tmp_file" "$banner_file"
    else
        rm -f "$tmp_file"
    fi
}

while true; do
    if [[ ! -s "$DB_FILE" ]]; then
        sleep "$SCAN_INTERVAL"
        continue
    fi

    printf -v current_ts '%(%s)T' -1
    dynamic_banners_enabled=false

    # Reset associative arrays each cycle (unset first to avoid stale data)
    unset session_pids locked_users uid_to_user loginuid_pids
    declare -A session_pids=()
    declare -A locked_users=()
    declare -A uid_to_user=()
    declare -A loginuid_pids=()

    while IFS=: read -r username _ uid _rest; do
        [[ -n "$username" && "$uid" =~ ^[0-9]+$ ]] && uid_to_user["$uid"]="$username"
    done < /etc/passwd

    # Method 1: process owner from ps
    while read -r ssh_pid ssh_owner; do
        [[ "$ssh_pid" =~ ^[0-9]+$ ]] || continue
        if [[ -n "$ssh_owner" && "$ssh_owner" != "root" && "$ssh_owner" != "sshd" ]]; then
            session_pids["$ssh_owner"]+="$ssh_pid "
        fi
    done < <(ps -C sshd -o pid=,user= 2>/dev/null)

    # Method 2: kernel loginuid (reliable even when sshd runs as root)
    for p in /proc/[0-9]*/loginuid; do
        [[ -f "$p" ]] || continue
        login_uid=""
        read -r login_uid < "$p" || login_uid=""
        [[ "$login_uid" =~ ^[0-9]+$ && "$login_uid" != "4294967295" ]] || continue

        session_user="${uid_to_user[$login_uid]}"
        [[ -n "$session_user" ]] || continue

        pid_dir=$(dirname "$p")
        pid_num=$(basename "$pid_dir")
        comm=""
        read -r comm < "$pid_dir/comm" || comm=""
        [[ "$comm" == "sshd" ]] || continue

        ppid_val=""
        while read -r key value; do
            if [[ "$key" == "PPid:" ]]; then
                ppid_val="${value:-}"
                break
            fi
        done < "$pid_dir/status"
        [[ "$ppid_val" == "1" ]] && continue

        loginuid_pids["$session_user"]+="$pid_num "
    done

    # Detect locked users via /etc/shadow (cheaper than passwd -Sa)
    if [[ -r /etc/shadow ]]; then
        while IFS=: read -r shadow_user shadow_hash _rest; do
            [[ -n "$shadow_user" && "${shadow_hash:0:1}" == "!" ]] && locked_users["$shadow_user"]=1
        done < /etc/shadow
    else
        while read -r passwd_user _ passwd_status _rest; do
            [[ "$passwd_status" == "L" ]] && locked_users["$passwd_user"]=1
        done < <(passwd -Sa 2>/dev/null)
    fi

    if [[ -f "/etc/vpsmanagerpro/banners_enabled" ]]; then
        mkdir -p "$BANNER_DIR"
        dynamic_banners_enabled=true
    fi

    while IFS=: read -r user pass expiry limit bandwidth_gb _extra; do
        [[ -z "$user" || "$user" == \#* ]] && continue

        # CRITICAL: unset before declare to reset per-user (bash declare is function-scoped)
        unset unique_pids
        declare -A unique_pids=()

        # Merge BOTH sources (union) for reliable counting
        for pid in ${session_pids[$user]} ${loginuid_pids[$user]}; do
            [[ "$pid" =~ ^[0-9]+$ ]] && unique_pids["$pid"]=1
        done

        online_count=${#unique_pids[@]}
        user_locked=false
        if [[ -n "${locked_users[$user]+x}" ]]; then
            user_locked=true
        fi

        expiry_ts=0
        if [[ "$expiry" != "Never" && -n "$expiry" ]]; then
            expiry_ts=$(date -d "$expiry" +%s 2>/dev/null || echo 0)
            if [[ "$expiry_ts" =~ ^[0-9]+$ ]] && (( expiry_ts > 0 && expiry_ts < current_ts )); then
                if ! $user_locked; then
                    usermod -L "$user" &>/dev/null
                    killall -u "$user" -9 &>/dev/null
                    locked_users["$user"]=1
                fi
                continue
            fi
        fi

        [[ "$limit" =~ ^[0-9]+$ ]] || limit=1
        if (( online_count > limit )); then
            if ! $user_locked; then
                usermod -L "$user" &>/dev/null
                killall -u "$user" -9 &>/dev/null
                (sleep 120; usermod -U "$user" &>/dev/null) &
                locked_users["$user"]=1
                user_locked=true
            else
                killall -u "$user" -9 &>/dev/null
            fi
        fi

        if $dynamic_banners_enabled; then
            days_left="N/A"
            if [[ "$expiry" != "Never" && -n "$expiry" && "$expiry_ts" =~ ^[0-9]+$ && $expiry_ts -gt 0 ]]; then
                diff_secs=$((expiry_ts - current_ts))
                if (( diff_secs <= 0 )); then
                    days_left="EXPIRED"
                else
                    d_l=$(( diff_secs / 86400 ))
                    h_l=$(( (diff_secs % 86400) / 3600 ))
                    if (( d_l == 0 )); then
                        days_left="${h_l}h left"
                    else
                        days_left="${d_l}d ${h_l}h"
                    fi
                fi
            fi

            bw_info="Unlimited"
            if [[ "$bandwidth_gb" != "0" && -n "$bandwidth_gb" ]]; then
                usagefile="$BW_DIR/${user}.usage"
                accum_disp=0
                if [[ -f "$usagefile" ]]; then
                    read -r accum_disp < "$usagefile"
                    [[ "$accum_disp" =~ ^[0-9]+$ ]] || accum_disp=0
                fi
                used_gb=$(awk "BEGIN {printf \"%.2f\", $accum_disp / 1073741824}")
                remain_gb=$(awk "BEGIN {r=$bandwidth_gb - $used_gb; if(r<0) r=0; printf \"%.2f\", r}")
                bw_info="${used_gb}/${bandwidth_gb} GB used | ${remain_gb} GB left"
            fi

            banner_content="<br><font color=\"yellow\"><b>      ✨ ACCOUNT STATUS ✨      </b></font><br><br>"
            banner_content+="<font color=\"white\">👤 <b>Username   :</b> $user</font><br>"
            banner_content+="<font color=\"white\">📅 <b>Expiration :</b> $expiry ($days_left)</font><br>"
            banner_content+="<font color=\"white\">📊 <b>Bandwidth  :</b> $bw_info</font><br>"
            banner_content+="<font color=\"white\">🔌 <b>Sessions   :</b> $online_count/$limit</font><br><br>"
            write_banner_if_changed "$user" "$banner_content"
        fi

        [[ -z "$bandwidth_gb" || "$bandwidth_gb" == "0" ]] && continue

        usagefile="$BW_DIR/${user}.usage"
        accumulated=0
        if [[ -f "$usagefile" ]]; then
            read -r accumulated < "$usagefile"
            [[ "$accumulated" =~ ^[0-9]+$ ]] || accumulated=0
        fi

        if (( ${#unique_pids[@]} == 0 )); then
            rm -f "$PID_DIR/${user}__"*.last 2>/dev/null
            continue
        fi

        delta_total=0
        for pid in "${!unique_pids[@]}"; do
            io_file="/proc/$pid/io"
            cur=0
            if [[ -r "$io_file" ]]; then
                rchar=0
                wchar=0
                while read -r key value; do
                    case "$key" in
                        rchar:) rchar=${value:-0} ;;
                        wchar:) wchar=${value:-0} ;;
                    esac
                done < "$io_file"
                cur=$((rchar + wchar))
            fi

            pidfile="$PID_DIR/${user}__${pid}.last"
            if [[ -f "$pidfile" ]]; then
                read -r prev < "$pidfile"
                [[ "$prev" =~ ^[0-9]+$ ]] || prev=0
                if (( cur >= prev )); then
                    d=$((cur - prev))
                else
                    d=$cur
                fi
                delta_total=$((delta_total + d))
            fi
            printf "%s\n" "$cur" > "$pidfile"
        done

        for f in "$PID_DIR/${user}__"*.last; do
            [[ -f "$f" ]] || continue
            fpid=${f##*__}
            fpid=${fpid%.last}
            [[ -d "/proc/$fpid" ]] || rm -f "$f"
        done

        new_total=$((accumulated + delta_total))
        printf "%s\n" "$new_total" > "$usagefile"

        quota_bytes=$(awk "BEGIN {printf \"%.0f\", $bandwidth_gb * 1073741824}")
        if [[ "$quota_bytes" =~ ^[0-9]+$ ]] && (( new_total >= quota_bytes )); then
            if ! $user_locked; then
                usermod -L "$user" &>/dev/null
                killall -u "$user" -9 &>/dev/null
                locked_users["$user"]=1
            fi
        fi
    done < "$DB_FILE"

    sleep "$SCAN_INTERVAL"
done
