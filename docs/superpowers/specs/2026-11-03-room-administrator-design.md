# #172 — Administrador de sala

## Propósito y decisiones aprobadas

El Owner puede nombrar a una persona que lo ayude a controlar y moderar la sala
sin cederle la propiedad. El usuario aprobó un único Administrador por sala y
que éste herede la sala cuando el Owner se vaya definitivamente. El Owner
conserva los 10 segundos de recuperación que hoy tiene ante una desconexión.

La interfaz aprobada está en `owp-pr/render-172/172-admin-{menu,confirm,assigned,remove}.png`
del workspace contenedor. En la lista de personas, el propietario actual
aparece como **Owner**. Cada invitado tiene `⋯` con **Hacer administrador** o **Quitar rol de
administrador**, además de **Quitar de la sala** y **Bloquear**. El cambio de
rol pide confirmación. Tras asignarlo, la fila muestra **Administrador** donde
antes no había una acción permanente. El ícono de Quitar es una persona con ×.

## Roles y permisos

| Acción | Owner | Administrador | Invitado |
| --- | --- | --- | --- |
| Reproducir, pausar, saltar, cambiar contenido y editar cola | Sí | Sí | Según permisos de la sala |
| Quitar o bloquear a un invitado | Sí | Sí | No |
| Quitar, bloquear o degradar al Administrador | Sí | No | No |
| Asignar Administrador | Sí | No | No |
| Cerrar la sala o transferir propiedad manualmente | Sí | No | No |
| Quitar o bloquear al Owner | No | No | No |

El rol de Administrador no cambia los permisos generales de los invitados y no
le da privilegios de administrador de Jellyfin. El servidor valida cada acción;
ocultar un botón en el cliente no constituye autorización. Las operaciones
fallidas devuelven un error de permiso, sin estado parcial.

## Identidad y ciclo de vida

- Solo puede existir un Administrador. El Owner debe retirarle el rol antes de
  nombrar a otra persona. La lista y el menú se actualizan para todos.
- El rol se vincula al usuario autenticado de Jellyfin, no al identificador de
  una conexión. Reconectar con la misma cuenta lo recupera durante la vida de
  la sala; otra cuenta no puede reclamarlo. Se requiere identidad no vacía.
- Varias pestañas de la misma cuenta comparten el rol a nivel de usuario, pero
  hay un solo sucesor al tomar la propiedad. El servidor escoge una conexión
  activa de ese usuario de forma determinista.
- Si el Owner se desconecta inesperadamente, OWP mantiene el plazo actual de
  10 segundos para que vuelva. Si vuelve, sigue siendo Owner. Al vencer el
  plazo, un Administrador conectado y compatible hereda la propiedad. Si no
  está, se aplica la sucesión existente. Una salida voluntaria transfiere de
  inmediato, con la misma prioridad. Si no hay sucesor, se cierra la sala como
  hoy.
- Al heredar, ese usuario pasa a ser Owner; se limpia el rol Administrador y se
  anuncia `host_changed`. El antiguo Owner que llegue después no recupera la
  propiedad automáticamente.
- Quitar o bloquear al Administrador elimina su rol antes de expulsarlo.
  El Administrador no puede bloquear ninguna conexión de la cuenta del Owner.

## Protocolo y compatibilidad

Agregar una capacidad negociada `room_administrator`. Un mensaje de acción del
Owner asigna o retira el rol por ID de participante; el servidor resuelve ese
ID a la cuenta autenticada y rechaza IDs ajenos o caducados. La respuesta de
estado informa la cuenta/participante con rol solo a clientes que negocien la
capacidad; los clientes antiguos siguen viendo el Owner existente. Los campos
desconocidos no se incorporan al `participant_list` legado; usar una extensión
negociada o un mensaje separado.

La integración debe partir de las ramas actuales de permisos de sala (#171),
moderación (#173) y acceso (#175/#221) ya publicadas, resolviendo sus cambios
compartidos sin duplicar implementación ni incluir cambios ajenos en el PR.
Si esas ramas aún no están en `main`, documentar claramente la dependencia del
PR y probar la combinación en laboratorio. El Administrador exige cliente y
servidor con la capacidad; una versión antigua no obtiene el rol ni la
prioridad sucesoria.

## Interfaz y accesibilidad

El botón `⋯` conserva su etiqueta accesible con el nombre del participante.
Las acciones del menú indican a quién afectan. Confirmar y cancelar devuelven
el foco al botón de esa fila. El distintivo de rol es texto, no solo color.
El Owner no ve la acción de nombrar a otro mientras ya exista un Administrador;
el servidor igualmente rechaza esa carrera si dos solicitudes llegan juntas.
El Administrador ve controles de reproducción, cola y moderación sobre invitados,
pero nunca los de rol o cierre. Localizar textos en los idiomas de OWP.

## Comprobación

Pruebas de servidor: solo Owner cambia rol; máximo uno; ID inválido; mismo
usuario en varias conexiones; reconexión; sucesión tras 10 segundos; salida
voluntaria; Administrador desconectado; bloqueo y revocación; clientes viejos;
acciones prohibidas contra Owner y otros administradores.

Pruebas de cliente: menús y confirmación, distintivos Owner/Administrador,
visibilidad por rol, foco y estado tras `host_changed`. Prueba de navegador
completa de dos personas y de recuperación del Owner. Probar la combinación
con #171/#173/#221 en laboratorio antes de publicar. Producción se trata
separadamente, después de las verificaciones.

## Revisión

Este documento concreta el diseño visual y las decisiones del chat. Requiere
revisión del usuario antes de escribir el plan de implementación.
