import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function ManageSubscription({ token, onBack }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  useEffect(() => {
    if (token) {
      loadSubscriptionInfo();
    }
  }, [token]);

  const loadSubscriptionInfo = async () => {
    setLoadingInfo(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/account/storage`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setSubscriptionInfo(data);
      } else {
        setError(data.error || strings.subscription.manage.errors.loadFailed);
      }
    } catch (err) {
      console.error('Failed to load subscription info:', err);
      setError(strings.subscription.manage.errors.loadFailed);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleManageSubscription = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/stripe/create-portal-session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.url) {
        // Redirect to Stripe customer portal
        window.location.href = data.url;
      } else {
        setError(data.error || strings.subscription.manage.errors.portalFailed);
      }
    } catch (err) {
      console.error('Failed to create portal session:', err);
      setError(strings.subscription.manage.errors.portalFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-8">
        <h1 className="text-xl md:text-2xl text-white mb-8">{strings.subscription.manage.title}</h1>

        {loadingInfo ? (
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
            <p className="text-[#666] text-sm">{strings.subscription.manage.loading}</p>
          </div>
        ) : subscriptionInfo ? (
          <div className="space-y-6">
            {/* Current Subscription Info */}
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
              <h2 className="text-base md:text-lg text-white mb-4">{strings.subscription.manage.currentPlan}</h2>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#666]">{strings.subscription.manage.plan}</span>
                  <span className="text-sm text-white font-medium">
                    {subscriptionInfo.supporterTier === 'quarterly' && strings.subscription.manage.plans.quarterly}
                    {subscriptionInfo.supporterTier === 'one_time' && strings.subscription.manage.plans.oneTime}
                    {!subscriptionInfo.supporterTier && strings.subscription.manage.plans.free}
                  </span>
                </div>

                {subscriptionInfo.supporterTier === 'quarterly' && (
                  <div className="mt-4 pt-4 border-t border-[#333]">
                    <p className="text-xs text-[#666] mb-4">
                      {strings.subscription.manage.quarterlyDescription}
                    </p>
                    <button
                      onClick={handleManageSubscription}
                      disabled={loading}
                      className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                    >
                      {loading ? strings.subscription.manage.loading : strings.subscription.manage.manageButton}
                    </button>
                    <p className="text-xs text-[#666] mt-2 text-center">
                      {strings.subscription.manage.manageDescription}
                    </p>
                  </div>
                )}

                {subscriptionInfo.supporterTier === 'one_time' && (
                  <div className="mt-4 pt-4 border-t border-[#333]">
                    <p className="text-xs text-[#666] mb-4">
                      {strings.subscription.manage.oneTimeDescription}
                    </p>
                    <button
                      onClick={() => window.location.href = '/account'}
                      className="w-full border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
                    >
                      {strings.subscription.manage.upgradeButton}
                    </button>
                  </div>
                )}

                {!subscriptionInfo.supporterTier && (
                  <div className="mt-4 pt-4 border-t border-[#333]">
                    <p className="text-xs text-[#666] mb-4">
                      {strings.subscription.manage.freeDescription}
                    </p>
                    <button
                      onClick={() => window.location.href = '/account'}
                      className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
                    >
                      {strings.subscription.manage.supportButton}
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-900 bg-opacity-20 border border-red-600 rounded">
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}
            </div>

            {/* Back button */}
            <button
              onClick={onBack}
              className="w-full border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
            >
              {strings.subscription.manage.backButton}
            </button>
          </div>
        ) : (
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
            <p className="text-red-400 text-sm">{error || strings.subscription.manage.errors.loadFailed}</p>
            <button
              onClick={() => window.location.href = '/account'}
              className="mt-4 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
            >
              {strings.subscription.manage.backButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
