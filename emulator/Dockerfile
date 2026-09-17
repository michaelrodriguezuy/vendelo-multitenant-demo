FROM node:20-bookworm-slim

# El emulador de Firestore corre sobre la JVM.
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-jre-headless ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g firebase-tools@13

# Bajar el jar del emulador en build time: sin esto cada arranque lo descarga
# de nuevo y el contenedor tarda en quedar sano.
RUN firebase setup:emulators:firestore

WORKDIR /app
COPY firebase.json firestore.rules firestore.indexes.json ./

EXPOSE 8085 4000

CMD ["firebase", "emulators:start", "--project", "demo-vendelo", "--only", "firestore"]
