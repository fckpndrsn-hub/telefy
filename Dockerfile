FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY profile_server.py telegram_auth.py user_database.py schema.sql ./
COPY server.py soundcloud_api.py ./
COPY web/ ./web/
COPY audio-player.js ./web/assets/audio-player.js
COPY telefy.html ./web/telefy.html
COPY styles.css telegram-layout.js player-controls.js app.js freshmen.js discovery.js user-profile.js ./web/assets/
ENV PYTHONUNBUFFERED=1 TELEFY_PRIVATE_DIR=/tmp/telefy-private
USER 10001
EXPOSE 10000
CMD ["python", "profile_server.py"]
