#!/bin/sh
set -e

# Initialize config if it doesn't exist
if [ ! -f /data/config.json ]; then
  echo '{}' > /data/config.json
  echo "OWL: Created default config at /data/config.json"
fi

# Run based on command
case "${1:-daemon}" in
  daemon)
    echo "OWL: Starting daemon..."
    exec node src/daemon/index.js --config /data/config.json
    ;;
  dashboard)
    echo "OWL: Starting dashboard on port ${PORT:-3000}..."
    exec node -e "
      import('./src/dashboard/server.js').then(m => m.startDashboard({ port: ${PORT:-3000} }));
    "
    ;;
  both)
    echo "OWL: Starting daemon + dashboard on port ${PORT:-3000}..."
    node -e "
      import('./src/dashboard/server.js').then(m => m.startDashboard({ port: ${PORT:-3000} }));
    " &
    exec node src/daemon/index.js --config /data/config.json
    ;;
  mcp)
    echo "OWL: Starting MCP server..."
    exec node src/mcp/server.js
    ;;
  *)
    exec "$@"
    ;;
esac
