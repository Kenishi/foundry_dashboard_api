FROM node:current-alpine

ENV LISTEN_PORT="45321"

WORKDIR /foundry_dashboard_api

COPY ./entrypoint.sh ./*.json ./
RUN ["npm", "install"]

RUN mkdir ./src
COPY ./src ./src

RUN ["chmod", "+x", "/foundry_dashboard_api/entrypoint.sh"]

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["./entrypoint.sh"]
