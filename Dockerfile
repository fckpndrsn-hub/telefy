FROM python:3.13-slim
WORKDIR /app
COPY server.py soundcloud_api.py ./
COPY web/ ./web/
ENV PYTHONUNBUFFERED=1 TELEFY_PRIVATE_DIR=/tmp/telefy-private
USER 10001
EXPOSE 10000
CMD ["python", "server.py"]
