# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app

COPY server.js index.html review.html taxonomy.html color.html styles.css script.js taxonomy.js color.js llm.js jszip.min.js ./

ENV PORT=80
ENV MODEL_ROUTER_MODEL=standard

EXPOSE 80
CMD ["node", "server.js"]
