#!/bin/sh
# Lo programa mckenna-website.service (ExecStopPost) para 8 s después de detenerse.
# Si la web no está activa ni arrancando, enciende la página de mantenimiento.
# Va en un archivo aparte porque, escrito en la unidad, el $(...) se expandía
# en el momento de parar (siempre "inactive") y la página se encendía también
# tras un `systemctl restart`, matando la web recién arrancada.
estado="$(systemctl show -p ActiveState --value mckenna-website.service 2>/dev/null)"
case "$estado" in
  active|activating|reloading) exit 0 ;;
  *) exec systemctl start mckenna-website-mantenimiento.service ;;
esac
