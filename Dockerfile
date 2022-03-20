FROM node:current-alpine

ENV LISTEN_PORT="45321"

WORKDIR /foundry_dashboard_api

RUN mkdir ./src
COPY ./src ./src
COPY ./entrypoint.sh ./*.json .dockerignore ./


RUN ["chmod", "+x", "/foundry_dashboard_api/entrypoint.sh"]
RUN ["npm", "install"]

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["./entrypoint.sh"]
