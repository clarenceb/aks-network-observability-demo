AKS Networking Observability add-on demo
========================================

Based on [Setup of Network Observability for Azure Kubernetes Service (AKS) - Azure managed Prometheus and Grafana](https://learn.microsoft.com/en-us/azure/aks/network-observability-managed-cli?tabs=non-cilium)

Create an AKS CNI Overlay Cluster (non-Cilium)
----------------------------------------------

```sh
# Install the aks-preview extension
az extension add --name aks-preview

# Update the extension to make sure you have the latest version installed
az extension update --name aks-preview

az feature register --namespace "Microsoft.ContainerService" --name "NetworkObservabilityPreview"
az feature show --namespace "Microsoft.ContainerService" --name "NetworkObservabilityPreview"

az provider register -n Microsoft.ContainerService

CLUSTER=aks-netobs
RG_NAME=aks-netobs
LOCATION=australiasoutheast
GRAFANA_LOCATION=australiaeast
POD_CIDR="192.168.0.0/16"
AZ_MON_NAME=netops-monitor
GRAFANA_NAME=netops-grafana

az group create \
    --name $RG_NAME \
    --location $LOCATION

az aks create \
    --name $CLUSTER \
    --resource-group $RG_NAME \
    --location eastus \
    --generate-ssh-keys \
    --network-plugin azure \
    --network-plugin-mode overlay \
    --pod-cidr $POD_CIDR \
    --enable-network-observability \
    --generate-ssh-keys

# TODO: Add a windows node pool (1 node)

az aks get-credentials --name $CLUSTER --resource-group $RG_NAME --overwrite-existing
kubectl get no,pod -A
```

Set up monitoring (Azure managed versions)
------------------------------------------

```sh
# Azure Monitor resource (Prometheus metrics)
az resource create \
    --resource-group $RG_NAME \
    --namespace microsoft.monitor \
    --resource-type accounts \
    --name $AZ_MON_NAME \
    --location $LOCATION \
    --properties '{}'

# Grafana resource
az grafana create \
    --name $GRAFANA_NAME \
    --resource-group $RG_NAME \
    --location $GRAFANA_LOCATION

grafanaId=$(az grafana show \
                --name $GRAFANA_NAME \
                --resource-group $RG_NAME \
                --query id \
                --output tsv)

azuremonitorId=$(az resource show \
                    --resource-group $RG_NAME \
                    --name $AZ_MON_NAME \
                    --resource-type "Microsoft.Monitor/accounts" \
                    --query id \
                    --output tsv)

# Link Azure Monitor and Grafana to AKS cluster
az provider register --namespace Microsoft.AlertsManagement --wait

az aks update \
    --name $CLUSTER \
    --resource-group $RG_NAME \
    --enable-azure-monitor-metrics \
    --azure-monitor-workspace-resource-id $azuremonitorId \
    --grafana-resource-id $grafanaId

# Verify the Azure Monitor pods are running.
kubectl get po -owide -n kube-system | grep ama-
```

Deploy Jaeger (distributed tracing)
-----------------------------------

```sh
# Install Jaeger
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts
helm repo update
helm install jaeger jaegertracing/jaeger
kubectl get pod # Wait until they are all Running

# You can log into the Jaeger Query UI like so:
export POD_NAME=$(kubectl get pods --namespace default -l "app.kubernetes.io/instance=jaeger,app.kubernetes.io/component=query" -o jsonpath="{.items[0].metadata.name}")
  echo http://127.0.0.1:8080/
  kubectl port-forward --namespace default $POD_NAME 8080:16686
```

Deploy sample microservices application
---------------------------------------

Based on `fake-service` sample at: https://github.com/nicholasjackson/fake-service/blob/main/examples/docker-compose-jaeger/docker-compose.yml

```sh
kubectl create ns sample-app
kubectl apply -f ./sample-app/sample-app.yaml -n sample-app
kubectl get svc,pod -n sample-app

kubectl port-forward svc/web 9090:9090 -n sample-app
curl -s http://localhost:9090/
```

Generate some traffic on the app
--------------------------------

```sh
k6 run ./sample-app/k6-script.js
```

Check the app topology
----------------------

```sh
kubectl port-forward svc/web 19090:9090 -n sample-app
```

Open: http://localhost:19090/ui in your browser to see the Fake Service topology

Analyse traffic using Networking Observability add-on
-----------------------------------------------------

* Navigate to the managed Grafana resource and click the dashboard URL.

* Login in with your Azure AD account.

* In the Grafana view, click "Dashboards/Import" and use ID `18814` to import the dashboard from Grafana's public dashboard repo.

* Select the managed Prometheus resource as the metrics source

* Browse the Network Observability Metrics dashboard

* Choose time range "Last 15 mins" and auto-rehresf every 5s

* (Optional) View `web` in Jaeger traces and also the Dependency Graph

(Optional) Add Windows node pool and deploy Windows version of fake-service
---------------------------------------------------------------------------

```sh
az acr create -n netobsreg -g $RG_NAME --sku Standard

wget https://github.com/nicholasjackson/fake-service/releases/download/v0.25.2/fake_service_windows_amd64.zip
unzip -t fake_service_windows_amd64.zip

az acr build -r netobsreg -t fake-service:win2022-v1 . --platform windows -f Dockerfile.win2022

az feature register --namespace "Microsoft.ContainerService" --name "AzureOverlayPreview"
az feature show --namespace "Microsoft.ContainerService" --name "AzureOverlayPreview"
az provider register --namespace Microsoft.ContainerService

az aks nodepool add \
    --resource-group $RG_NAME \
    --cluster-name $CLUSTER \
    --os-type Windows \
    --name npwin \
    --node-vm-size Standard_D4s_v3 \
    --node-count 1 \
    --node-taints "kubernetes.io/os=windows:NoSchedule"

az aks update --name $CLUSTER --resource-group $RG_NAME --attach-acr netobsreg

# Uncomment `sample-app.yaml` sections marked as "Windows only"

kubectl apply -f ./sample-app/sample-app.yaml -n sample-app
kubectl get svc,pod -n sample-app

kubectl port-forward svc/web 9090:9090 -n sample-app
curl -s http://localhost:9090/
```

Cleanup
-------

```sh
az group delete \
    --name $RG_NAME
```

Resources
---------

* https://github.com/nicholasjackson/fake-service
* https://learn.microsoft.com/en-us/azure/aks/network-observability-managed-cli?tabs=non-cilium
