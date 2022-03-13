FROM node:current-alpine

ENV LISTEN_PORT="45321"

WORKDIR /foundry_dashboard_api

COPY ./src ./src
COPY ./entrypoint.sh ./*.json .dockerignore ./


RUN ["chown", "+x", "/foundry_dashboard_api/entrypoint.sh"]
RUN ["npm", "install"]

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["./entrypoint.sh"]