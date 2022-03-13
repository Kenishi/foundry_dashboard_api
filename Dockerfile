FROM node:current-alpine

ARG LISTEN_PORT

WORKDIR /foundry_dashboard_api

ADD ./ /

RUN ["npm", "install"]

VOLUME [ "/foundry_dashboard_api" ]

ENTRYPOINT ["npm", "start"]