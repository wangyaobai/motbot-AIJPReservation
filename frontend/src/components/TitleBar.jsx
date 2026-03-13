import { Link, useNavigate } from 'react-router-dom';
import { useUiLang } from '../context/UiLangContext';

/** 首页/预约页用：标题严格居中，右侧小图标+文字；下方可接背景图 */
export function TitleBar({ showLangToggle }) {
  const { uiLang, toggleUiLang } = useUiLang();
  const isEn = uiLang === 'en';
  return (
    <>
      <header className="title-bar title-bar-center">
        <div className="title-bar-left" aria-hidden="true">
          {showLangToggle && (
            <button
              type="button"
              onClick={toggleUiLang}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: '#fff',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              {isEn ? '中文' : 'EN'}
            </button>
          )}
        </div>
        <div className="title-bar-inner">
          <h1 className="title-bar-title">
            {isEn ? '🥢 AI Restaurant Booking' : '🥢 日本餐厅 AI 代预约'}
          </h1>
          <p className="title-bar-subtitle">
            {isEn ? (
              <>
                Book restaurants in Japan &amp; overseas
                <br />
                AI calls the restaurant for you
              </>
            ) : (
              <>
                不会日语？
                <br />
                AI 帮您用日语致电餐厅预约
              </>
            )}
          </p>
        </div>
        <div className="title-bar-actions">
          <Link
            to="/orders"
            className="title-bar-action"
            title={isEn ? 'Orders' : '我的订单'}
            aria-label={isEn ? 'Orders' : '我的订单'}
          >
            <OrderIcon />
            <span>{isEn ? 'Orders' : '订单'}</span>
          </Link>
          <Link
            to="/profile"
            className="title-bar-action"
            title={isEn ? 'Profile' : '个人中心'}
            aria-label={isEn ? 'Profile' : '个人中心'}
          >
            <ProfileIcon />
            <span>{isEn ? 'Profile' : '个人中心'}</span>
          </Link>
        </div>
      </header>
      <div className="title-bar-banner" aria-hidden="true" />
    </>
  );
}

/** 内页用：左侧返回或首页，中间标题。onBackClick 优先；否则 backTo 为字符串时跳转该路径，为数字时 history 后退；useHomeIcon 为 true 时左侧显示首页图标并跳转首页；showLangToggle 为 true 时右侧显示 中文/EN 切换 */
export function PageTitleBar({ title, backTo, useHomeIcon, showLangToggle, onBackClick }) {
  const navigate = useNavigate();
  const { uiLang, toggleUiLang } = useUiLang();
  const isEn = uiLang === 'en';
  const handleLeft = () => {
    if (typeof onBackClick === 'function') {
      onBackClick();
      return;
    }
    if (useHomeIcon) {
      navigate('/');
      return;
    }
    if (typeof backTo === 'string') navigate(backTo);
    else navigate(-1);
  };
  return (
    <header className="title-bar title-bar-with-back">
      <button
        type="button"
        className="title-bar-back"
        onClick={handleLeft}
        aria-label={useHomeIcon ? (isEn ? 'Home' : '首页') : (isEn ? 'Back' : '返回')}
      >
        {(useHomeIcon === true) ? <HomeIcon /> : <BackIcon />}
      </button>
      <h1 className="title-bar-heading">{title}</h1>
      <span className="title-bar-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {showLangToggle && (
          <button
            type="button"
            onClick={toggleUiLang}
            style={{
              padding: '4px 8px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: '#fff',
              fontSize: '0.7rem',
              cursor: 'pointer',
            }}
          >
            {isEn ? '中文' : 'EN'}
          </button>
        )}
      </span>
    </header>
  );
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

/** 笔记本/菜单列表样式 */
function OrderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="12" y2="9" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
