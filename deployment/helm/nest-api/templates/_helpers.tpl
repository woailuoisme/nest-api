{{/*
Expand the name of the chart.
*/}}
{{- define "nest-api.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "nest-api.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "nest-api.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "nest-api.labels" -}}
helm.sh/chart: {{ include "nest-api.chart" . }}
app.kubernetes.io/name: {{ include "nest-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
API component labels.
*/}}
{{- define "nest-api.api.labels" -}}
{{ include "nest-api.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Worker component labels.
*/}}
{{- define "nest-api.worker.labels" -}}
{{ include "nest-api.labels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
API selector labels.
*/}}
{{- define "nest-api.api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nest-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Worker selector labels.
*/}}
{{- define "nest-api.worker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nest-api.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "nest-api.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "nest-api.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the ConfigMap name.
*/}}
{{- define "nest-api.configMapName" -}}
{{- if .Values.config.existingConfigMap }}
{{- .Values.config.existingConfigMap }}
{{- else }}
{{- printf "%s-config" (include "nest-api.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Get the Secret name.
*/}}
{{- define "nest-api.secretName" -}}
{{- if .Values.secret.existingSecret }}
{{- .Values.secret.existingSecret }}
{{- else }}
{{- printf "%s-secret" (include "nest-api.fullname" .) }}
{{- end }}
{{- end }}

