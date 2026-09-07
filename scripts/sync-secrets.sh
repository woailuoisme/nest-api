#!/usr/bin/env bash
# ==============================================================================
# Universal GitHub Secrets & Variables Sync Script
# Parses INI configuration files ([secrets] & [vars]) and syncs to GitHub via gh CLI.
# Works across any Git repository or project stack.
# ==============================================================================

set -e

# 1. Config file discovery
find_config() {
  if [ -n "$1" ] && [ -f "$1" ]; then
    echo "$1"
    return
  fi
  for file in secret.ini secrets.ini .env.secrets secret.example.ini; do
    if [ -f "$file" ]; then
      echo "$file"
      return
    fi
  done
}

INI_FILE=$(find_config "$1")

if [ -z "$INI_FILE" ]; then
  echo "Error: Configuration file not found."
  echo "Tip: Create a secret.ini file with [secrets] and [vars] sections."
  exit 1
fi

# 2. Dependency checks
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI ('gh') is not installed (https://cli.github.com/)."
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo "Error: GitHub CLI is not authenticated. Please run 'gh auth login'."
  exit 1
fi

echo "Syncing configuration from '$INI_FILE' to GitHub..."

current_section=""
key=""
val=""
in_multiline=false

while IFS= read -r line || [ -n "$line" ]; do
  if ! $in_multiline; then
    trimmed=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [[ -z "$trimmed" || "$trimmed" =~ ^[#\;] ]]; then
      continue
    fi

    if [[ "$trimmed" =~ ^\[([a-zA-Z0-9_-]+)\]$ ]]; then
      current_section="${BASH_REMATCH[1]}"
      echo "Section: [$current_section]"
      continue
    fi
  fi

  if ! $in_multiline; then
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"

      if [[ "$val" =~ ^\"(.*)$ && ! "$val" =~ ^\"(.*)\"$ ]]; then
        in_multiline=true
        val="${BASH_REMATCH[1]}"
        continue
      fi

      val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    else
      continue
    fi
  else
    if [[ "$line" =~ (.*)\"$ ]]; then
      val+=$'\n'"${BASH_REMATCH[1]}"
      in_multiline=false
    else
      val+=$'\n'"$line"
      continue
    fi
  fi

  if [[ -z "$key" || -z "$val" ]]; then
    if [ -n "$key" ]; then
      echo "Skipping empty key: $key"
    fi
    key=""
    val=""
    continue
  fi

  if [[ "$current_section" == "secrets" ]]; then
    echo "Writing Secret: $key"
    echo "$val" | gh secret set "$key" || true
  elif [[ "$current_section" == "vars" || "$current_section" == "variables" ]]; then
    echo "Writing Variable: $key"
    echo "$val" | gh variable set "$key" 2>/dev/null || echo "$val" | gh variable set "$key" --body "$val" || true
  else
    echo "Warning: Skipping unknown section [$current_section]: $key"
  fi

  key=""
  val=""
done < "$INI_FILE"

echo "Sync completed successfully."
