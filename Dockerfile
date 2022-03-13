FROM node:current-alpine

ENV LISTEN_PORT="45321"

WORKDIR /foundry_dashboard_api

ADD ./ /

RUN ["npm", "install"]

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["LISTEN_PORT=$LISTEN_PORT", "npm", "start"]