import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Modal } from './ui';

/** First-use privacy notice required before working with learner data (RA 10173). */
export function PrivacyNotice() {
  const { reload, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      locked
      onClose={() => undefined}
      title="Privacy notice"
      footer={
        <>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.post('/me/privacy-ack');
              await reload();
            }}
          >
            I understand and agree
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-2">
        <p>E-QuAART processes personal information of learners — names, Learner Reference Numbers, and assessment results — to support instruction, intervention and monitoring by DepEd personnel.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Use learner information only for the legitimate educational purpose of your role.</li>
          <li>Do not share screens, exports or printouts with anyone who does not have a need to know.</li>
          <li>Exports containing learner information are marked confidential; store them securely and delete them when no longer needed.</li>
          <li>Every view, change and export you make is recorded in the audit trail.</li>
          <li>Report any suspected data breach immediately to the Division Data Protection Officer.</li>
        </ul>
        <p className="text-xs text-ink-3">Processing is carried out in accordance with the Data Privacy Act of 2012 (RA 10173), its IRR, NPC issuances, and applicable DepEd policies.</p>
      </div>
    </Modal>
  );
}
