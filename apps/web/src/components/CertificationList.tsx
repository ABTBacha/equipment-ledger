import { CertificationView } from '../lib/types';

export function CertificationList({ certifications }: { certifications: CertificationView[] }) {
  const now = Date.now();
  return (
    <ul className="space-y-1">
      {certifications.map((cert) => {
        const expired = new Date(cert.expiresAt).getTime() < now;
        return (
          <li key={cert.code} className="flex items-center gap-2 text-sm">
            <span>{cert.code}</span>
            <span className={expired ? 'text-red-600 font-medium' : 'text-gray-500'}>
              {expired ? 'Expired' : 'Valid'} until {new Date(cert.expiresAt).toLocaleDateString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
