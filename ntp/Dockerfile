# Hands this server's time to the DVR/NVRs on the camera LAN. chrony runs with -x: it never touches the
# host clock, it only tracks real time from upstream and serves it.
FROM alpine:3.20
RUN apk add --no-cache chrony
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 123/udp
ENTRYPOINT ["/entrypoint.sh"]
