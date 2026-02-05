import Modal from './Modal';

function ConfirmDropModal({
  isOpen,
  onClose,
  title,
  subtitle,
  detail,
  note,
  actions = [],
}) {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth={520}>
      <h2>{title}</h2>
      {subtitle && <p class="dialog-subtitle">{subtitle}</p>}
      {detail && <div class="drop-confirm-detail">{detail}</div>}
      {note && <div class="drop-confirm-note">{note}</div>}
      <div class="drop-confirm-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            class={action.variant === 'primary' ? 'primary-button' : 'secondary-button'}
            onClick={action.onClick}
            disabled={action.disabled}
            type="button"
          >
            {action.label}
          </button>
        ))}
        <button class="link-button" onClick={onClose} type="button">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDropModal;
