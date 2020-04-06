#!/bin/bash
MY_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
MY_DIR="$(dirname $MY_PATH)"
cd $MY_DIR

export LOG_TO_FILE=true
export NODE_ENV=development
export GKE_CREDENTIALS_PATH=credentials.json
export GKE_REGION=us-central1-a
#us-west1-c
export GKE_K8S_CLUSTER=kubevious-samples
#gprod-uswest1c
# export DEBUG=express:*
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export KUBEVIOUS_COLLECTOR=http://localhost:4000/api/v1/collect
nodemon mock/index-gke