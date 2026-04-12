#!/bin/bash
# Compat: delega al diagnóstico completo (8080/8081/8083 + systemd).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/diagnostico_servicios_mcKenna.sh"
