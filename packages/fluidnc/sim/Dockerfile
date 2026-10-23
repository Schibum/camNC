# FluidNC v4.1.1 posix simulator (linux_x86_64) with the JP2 LowRider config. Used by `pnpm sim --docker`.
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir platformio
RUN git clone --depth 1 --branch v4.1.1 https://github.com/bdring/FluidNC.git /src
WORKDIR /src
RUN pio run -e linux_x86_64

FROM debian:bookworm-slim
COPY --from=build /src/.pio/build/linux_x86_64/program /usr/local/bin/fluidnc-sim
COPY config.yaml /sim/native_localfs/config.yaml
WORKDIR /sim
RUN mkdir -p native_sd
ENV HTTP_PORT=8848
CMD printf '$HTTP/Port=%s\n$Bye\n' "$HTTP_PORT" | fluidnc-sim >/dev/null; exec fluidnc-sim
