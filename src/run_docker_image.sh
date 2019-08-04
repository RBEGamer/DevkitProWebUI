#!/usr/bin/env bash

docker run -p 3015:3015 -v "$(pwd)/app/build_files:/usr/src/app/build_files" devkitprowebui