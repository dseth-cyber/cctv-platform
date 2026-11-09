#!/bin/sh
# NTP_UPSTREAM: comma list of servers to follow (a name with "pool" in it is used as a pool).
# NTP_ALLOW:    comma list of networks allowed to ask, or "all". Reach is limited by the bind address in compose;
#               on a Linux host (source addresses kept) set it to the camera LAN, e.g. 192.168.30.0/24.
set -eu
conf=/etc/chrony/chrony.conf
mkdir -p /etc/chrony /var/lib/chrony
{
  for s in $(echo "${NTP_UPSTREAM:-pool.ntp.org}" | tr ',' ' '); do
    case "$s" in *pool*) echo "pool $s iburst" ;; *) echo "server $s iburst" ;; esac
  done
  for a in $(echo "${NTP_ALLOW:-all}" | tr ',' ' '); do
    if [ "$a" = all ]; then echo "allow all"; else echo "allow $a"; fi
  done
  # With upstream gone, keep answering at stratum 10: recorders stay in step with each other,
  # and the system refuses to point a new recorder here until upstream is back.
  echo "local stratum 10"
  echo "driftfile /var/lib/chrony/drift"
  echo "cmdport 0"
} > "$conf"
cat "$conf"
# A restart keeps the container filesystem: an old pid file naming pid 1 would make chronyd think it is
# already running and quit, over and over.
rm -f /var/run/chrony/chronyd.pid /run/chrony/chronyd.pid
exec chronyd -d -x -f "$conf"
