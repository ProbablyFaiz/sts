set dotenv-load := true

default:
    just --list


master-build:
    cd master && npm run build

master-push remote="main":
    cd master && club push {{remote}}


master-deploy remote="main":
    cd master && just master-build && just master-push {{remote}}

publisher-build *ARGS:
    cd publisher && docker build -t $GCP_CONTAINER_TAG . --build-arg PUBLISHER_API_KEY=$PUBLISHER_API_KEY {{ARGS}}

publisher-push:
    cd publisher && docker push $GCP_CONTAINER_TAG

publisher-deploy:
    cd publisher && gcloud run deploy publisher \
        --image $GCP_CONTAINER_TAG \
        --platform managed \
        --region us-central1 \
        --port 80 \
        --memory 3Gi \
        --cpu 2 \
        --min-instances 0 \
        --max-instances 500 \
        --timeout 60s \
        --concurrency 1 \
        --ingress all \
        --allow-unauthenticated \
        --service-account=sbts-publisher@$GCP_PROJECT_ID.iam.gserviceaccount.com \
        --set-env-vars "PUBLISHER_API_KEY=$PUBLISHER_API_KEY,BUCKET_NAME=$BUCKET_NAME,BUCKET_PUBLIC_URL=$BUCKET_PUBLIC_URL,BUCKET_ACCESS_KEY_ID=$BUCKET_ACCESS_KEY_ID,BUCKET_SECRET_ACCESS_KEY=$BUCKET_SECRET_ACCESS_KEY,BUCKET_ENDPOINT=$BUCKET_ENDPOINT"
publisher-logs:
    gcloud run services logs read publisher --gen2 --region=us-central1 --stream

fanout-build:
    cd publisher/fanout && npm run build

fanout-deploy:
    cd publisher/fanout && gcloud functions deploy publisher_fanout \
        --gen2 \
        --runtime=nodejs22 \
        --region=us-central1 \
        --source=. \
        --entry-point=handler \
        --trigger-http \
        --allow-unauthenticated \
        --service-account=publisher-fanout@$GCP_PROJECT_ID.iam.gserviceaccount.com \
        --set-env-vars "FANOUT_PUBLISHER_ENDPOINT=$PUBLISHER_ENDPOINT,FANOUT_API_KEY=$PUBLISHER_API_KEY"

fanout-logs:
    gcloud functions logs read publisher_fanout --gen2 --region=us-central1
