FROM python:3.13-slim
WORKDIR /app
COPY curated_trends.py trends-approved.json hits-approved.json legends-approved.json night-approved.json ./
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY music_export.py openai_music.py music_features.py ./
COPY bot_operations.py ./
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY telefy_bot.py bot_store.py bot_integration.py reminder_store.py bot_reminders.py bot_posts.py bot_buttons.py ./
COPY profile_server.py telegram_auth.py user_database.py schema.sql music_policy.py scene_roster.json ./
COPY server.py soundcloud_api.py max_billing.py max-checkout.html max-beta.html ./
COPY web/ ./web/
COPY audio-player.js ./web/assets/audio-player.js
COPY telefy.html ./web/telefy.html
COPY library_store.py ./
COPY library-client.js ./web/assets/library-client.js
COPY max-client.js ./web/assets/max-client.js
COPY styles.css telegram-layout.js player-controls.js app.js freshmen.js discovery.js user-profile.js music-policy.js soundcloud-catalog.js personal-vibe.js first-run.js ./web/assets/
COPY music-features.js flow-discovery.js ./web/assets/
COPY app-control.js ./web/assets/app-control.js
COPY bot-entry.js ./web/assets/bot-entry.js
COPY reminders-client.js ./web/assets/reminders-client.js
ENV PYTHONUNBUFFERED=1 TELEFY_PRIVATE_DIR=/tmp/telefy-private
USER 10001
EXPOSE 10000
CMD ["python", "profile_server.py"]
