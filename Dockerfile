FROM node:22-alpine

RUN adduser -D -u 1000 user
USER user
ENV HOME=/home/user
WORKDIR $HOME/app

COPY --chown=user . $HOME/app

EXPOSE 7860
CMD ["node", "serve-static.mjs", ".", "7860", "--host", "0.0.0.0"]
