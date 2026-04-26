FROM minio/minio:latest

ENV MINIO_API_PORT=9000
ENV MINIO_CONSOLE_PORT=9001

EXPOSE 9000 9001

# Railway sets PORT to a single value; we forward it to MINIO_API_PORT so the
# service's public port matches what the platform expects.
CMD ["sh", "-c", "minio server /data --address :${PORT:-9000} --console-address :9001"]
