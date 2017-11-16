FROM mhart/alpine-node:8

MAINTAINER Shaun Warman <github.com/shaunwarman>

WORKDIR /app

COPY . .

RUN apk update \
    && apk add strace \
    && npm install

LABEL agent.version=0.0.1

CMD ["node", "index.js"]
