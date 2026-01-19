/**
 * Cloud GPU Settings Form
 * Extracted from ConnectStorageDialog.
 */

import { useState, useCallback, useMemo } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCheck,
  faSpinner,
  faExclamationTriangle,
  faQuestion,
  faChevronRight,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
import { loadCloudGpuSettings, saveCloudGpuSettings } from '../storage/cloudGpuSettings.js';

/**
 * Expandable FAQ item
 */
function FaqItem({ question, children }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="faq-item">
      <button
        class="faq-question"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <FontAwesomeIcon icon={faQuestion} className="faq-icon" />
        <span>{question}</span>
        <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} className="faq-chevron" />
      </button>
      {expanded && (
        <div class="faq-answer">
          {children}
        </div>
      )}
    </div>
  );
}

function CloudGpuForm({ onBack }) {
  const initialSettings = useMemo(
    () => loadCloudGpuSettings() || { apiUrl: '', apiKey: '' },
    []
  );
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [apiUrl, setApiUrl] = useState(initialSettings.apiUrl);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const trimmedSettings = useMemo(() => ({
    apiUrl: apiUrl.trim(),
    apiKey: apiKey.trim(),
  }), [apiUrl, apiKey]);
  const trimmedSaved = useMemo(() => ({
    apiUrl: savedSettings.apiUrl?.trim?.() || '',
    apiKey: savedSettings.apiKey?.trim?.() || '',
  }), [savedSettings]);
  const isSettingsReady = Boolean(trimmedSettings.apiUrl && trimmedSettings.apiKey);
  const settingsChanged =
    trimmedSettings.apiUrl !== trimmedSaved.apiUrl ||
    trimmedSettings.apiKey !== trimmedSaved.apiKey;
  const shouldFadeSaveText = !isSettingsReady || !settingsChanged;

  const handleSave = useCallback(() => {
    if (!trimmedSettings.apiUrl || !trimmedSettings.apiKey) {
      setError('Enter API URL and API key.');
      return;
    }

    setStatus('saving');
    setError(null);

    const ok = saveCloudGpuSettings({
      apiUrl: trimmedSettings.apiUrl,
      apiKey: trimmedSettings.apiKey,
    });

    if (!ok) {
      setStatus('idle');
      setError('Failed to save Cloud GPU settings.');
      return;
    }

    setSavedSettings({
      apiUrl: trimmedSettings.apiUrl,
      apiKey: trimmedSettings.apiKey,
    });
    setStatus('success');
    setTimeout(() => setStatus('idle'), 800);
  }, [trimmedSettings]);

  return (
    <div class="storage-form">
      <button class="back-button" onClick={onBack}>
        {'Back'}
      </button>

      <h3>Cloud GPU Configuration</h3>

      <div style={{ 
        background: 'rgba(255, 255, 255, 0.03)', 
        border: '1px solid rgba(255, 255, 255, 0.08)', 
        borderRadius: '8px', 
        padding: '16px', 
        fontSize: '0.9em',
        lineHeight: '1.5',
        marginTop: '16px',
        color: 'var(--text-secondary, #bbb)' 
      }}>
        <p style={{ margin: '0 0 10px 0' }}>
         This feature connects to your personal instance of the companion container running on <a href="https://modal.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Modal.com</a>.
        </p>
        <ul style={{ margin: '0', paddingLeft: '18px', listStyleType: 'disc' }}>
          <li style={{ marginBottom: '6px' }}>Modal provides a generous free tier for GPU compute.</li>
          <li>
             Use our <a href="https://github.com/your-org/your-modal-container" target="_blank" rel="noopener noreferrer" style={{ color: '#57b8cb', textDecoration: 'none', fontWeight: 500 }}>optimized container template</a> to deploy the backend in minutes.
          </li>
        </ul>
      </div>

      <div class="config-grid" style={{ marginTop: '20px' }}>
        <div class="form-field">
          <label>Endpoint URL</label>
          <input
            type="url"
            placeholder="https://user-container-name.modal.run"
            value={apiUrl}
            onInput={(e) => setApiUrl(e.target.value)}
          />
        </div>

        <div class="form-field">
          <label>API key</label>
          <input
            placeholder="cloud gpu api key"
            type='text'
            value={apiKey}
            onInput={(e) => setApiKey(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div class="form-error">
          <FontAwesomeIcon icon={faExclamationTriangle} />
          {' '}{error}
        </div>
      )}

      <button
        class={`secondary-button save-settings-btn ${isSettingsReady ? 'is-ready' : ''}`}
        onClick={handleSave}
        disabled={status === 'saving' || !isSettingsReady || !settingsChanged}
        style={{ marginTop: '16px' }}
      >
        {status === 'saving' ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            {' '}Saving...
          </>
        ) : status === 'success' ? (
          <>
            <FontAwesomeIcon icon={faCheck} />
            {' '}Saved
          </>
        ) : (
          <span class={`save-settings-text ${shouldFadeSaveText ? 'is-muted' : ''}`}>
            Save Cloud GPU settings
          </span>
        )}
      </button>

      <div class="faq-section" style={{ marginTop: '24px' }}>
        <FaqItem question="What does this do?">
          <p>It enables "Image to 3DGS" uploads. Raw images are sent to your cloud endpoint, converted to splats, and saved directly to your Supabase storage.</p>
        </FaqItem>

        <FaqItem question="Where do I find my credentials?">
          <p>The URL is generated when you deploy the container app. The API Key is defined by you in the container's secrets.</p>
        </FaqItem>

        <FaqItem question="Is this required for Supabase uploads?">
          <p>No. You only need Cloud GPU settings if you plan to convert images before upload.</p>
        </FaqItem>
      </div>

      <p class="form-note" style={{ marginTop: '16px' }}>
        <a href="https://modal.com" target="_blank" rel="noreferrer noopener">Modal dashboard</a>
        {' · ' }
        <a href="https://modal.com/docs" target="_blank" rel="noreferrer noopener">Modal docs</a>
        {' · ' }
        <a href="https://github.com/your-org/your-modal-container" target="_blank" rel="noreferrer noopener">
          Container repo
        </a>
      </p>
    </div>
  );
}

export default CloudGpuForm;