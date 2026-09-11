FROM node:22-alpine

WORKDIR /app
RUN addgroup -S nntp && adduser -S nntp -G nntp

COPY nntp-gateway.mjs /app/nntp-gateway.mjs

ENV NODE_ENV=production \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORT=1119

EXPOSE 1119
USER nntp

CMD ["node", "/app/nntp-gateway.mjs"]
