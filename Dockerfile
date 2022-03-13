FROM node:current-alpine

ARG LISTEN_PORT

WORKDIR /foundry_dashboard_api

ADD ./ /

RUN ["npm", "install"]

EXPOSE $LISTEN_PORT/tcp

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["npm", "start"]