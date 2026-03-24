import styles from './LoginPage.module.css';

export function LoginPage({ onSignIn }) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Prospect Tracker</h1>
        <p className={styles.subtitle}>Sign in to manage your sales pipeline</p>
        <button className={styles.googleBtn} onClick={onSignIn}>
          <span className={styles.googleIcon}>G</span>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
