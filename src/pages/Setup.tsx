import { Brand, LangSwitch } from '../components/ui';
import { useI18n } from '../i18n';

/** Page d'attente tant que la base de données n'est pas branchée. */
export function Setup() {
  const { t } = useI18n();
  return (
    <div className="center-screen">
      <main className="auth auth-wide stack-lg">
        <div className="row-between"><Brand /><LangSwitch /></div>
        <h1 className="h1">{t('setup.title')}</h1>
        <p className="muted">{t('setup.body')}</p>
      </main>
    </div>
  );
}
