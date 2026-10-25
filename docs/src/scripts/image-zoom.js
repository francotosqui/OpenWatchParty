export function initializeImageZoom() {
  const screenshots = document.querySelectorAll('.sl-markdown-content img[src*="/assets/images/"]');
  if (!screenshots.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'screenshot-lightbox';
  dialog.setAttribute('aria-label', 'Enlarged screenshot');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'screenshot-lightbox-close';
  closeButton.setAttribute('aria-label', 'Close enlarged screenshot');
  closeButton.textContent = '×';

  const enlargedImage = document.createElement('img');
  const caption = document.createElement('p');
  caption.className = 'screenshot-lightbox-caption';

  dialog.append(closeButton, enlargedImage, caption);
  document.body.append(dialog);

  let lastTrigger;

  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    lastTrigger?.focus({ preventScroll: true });
  });

  for (const screenshot of screenshots) {
    if (screenshot.closest('a, button')) continue;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'screenshot-zoom-trigger';
    trigger.setAttribute('aria-label', `Enlarge screenshot: ${screenshot.alt || 'image'}`);
    screenshot.before(trigger);
    trigger.append(screenshot);

    trigger.addEventListener('click', () => {
      lastTrigger = trigger;
      enlargedImage.src = screenshot.currentSrc || screenshot.src;
      enlargedImage.alt = screenshot.alt;
      caption.textContent = screenshot.alt;
      caption.hidden = !screenshot.alt;
      dialog.showModal();
    });
  }
}
