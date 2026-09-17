FROM node:20-bookworm-slim
WORKDIR /app

COPY frontend/package.json ./frontend/package.json
RUN cd frontend && npm install

COPY frontend ./frontend
COPY shared ./shared

WORKDIR /app/frontend
EXPOSE 5173
CMD ["npm", "run", "dev"]
