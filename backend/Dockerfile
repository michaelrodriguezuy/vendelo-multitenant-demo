FROM node:20-bookworm-slim
WORKDIR /app

# Las dependencias se instalan en la RAÍZ de la imagen, no dentro de backend/.
# El seed vive en /app/seed y Node resuelve node_modules subiendo desde el
# directorio del archivo importador: con node_modules en /app/backend, un
# import desde /app/seed/seed.js no lo encuentra.
COPY backend/package.json ./package.json
RUN npm install --omit=dev

COPY backend ./backend
COPY shared ./shared
COPY seed ./seed

EXPOSE 8080
CMD ["node", "backend/src/index.js"]
