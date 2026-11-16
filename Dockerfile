FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY telefy_bot.py bot_store.py bot_integration.py reminder_store.py bot_reminders.py bot_posts.py bot_buttons.py ./
COPY bot-entry.js ./web/assets/bot-entry.js
COPY reminders-client.js ./web/assets/reminders-client.js
COPY profile_server.py telegram_auth.py user_database.py schema.sql music_policy.py scene_roster.json ./
COPY server.py soundcloud_api.py max_billing.py max-checkout.html max-beta.html ./
COPY web/ ./web/
COPY audio-player.js ./web/assets/audio-player.js
COPY telefy.html ./web/telefy.html
COPY library_store.py ./
COPY library-client.js ./web/assets/library-client.js
COPY max-client.js ./web/assets/max-client.js
COPY styles.css telegram-layout.js player-controls.js app.js freshmen.js discovery.js user-profile.js music-policy.js soundcloud-catalog.js personal-vibe.js first-run.js ./web/assets/
ENV PYTHONUNBUFFERED=1 TELEFY_PRIVATE_DIR=/tmp/telefy-private
USER 10001
EXPOSE 10000
CMD ["python", "profile_server.py"]
