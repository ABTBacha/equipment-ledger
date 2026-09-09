import { CertificationView } from '../lib/types';

export function CertificationList({ certifications }: { certifications: CertificationView[] }) {
  const now = Date.now();
  return (
    <ul className="space-y-1">
      {certifications.map((cert) => {
        const expired = new Date(cert.expiresAt).getTime() < now;
        return (
          <li key={cert.code} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-primary">{cert.code}</span>
            <span className={expired ? 'text-accent-red font-medium' : 'text-muted'}>
              {expired ? 'Expired' : 'Valid'} until {new Date(cert.expiresAt).toLocaleDateString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
