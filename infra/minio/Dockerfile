FROM minio/minio:latest

EXPOSE 9000 9001

# minio is the ENTRYPOINT, so CMD args are appended to it.
# API on 9000, console on 9001. Internal-only access via Railway's
# private network (minio.railway.internal:9000) — no public domain needed.
CMD ["server", "/data", "--console-address", ":9001"]
