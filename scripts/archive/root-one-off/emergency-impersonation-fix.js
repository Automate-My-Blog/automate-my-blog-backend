// Emergency fix for impersonation exit issue
// Run this in browser console if the "Exit Impersonation" button still fails

console.log('🚨 Emergency Impersonation Exit Fix');

// Step 1: Call the backend API directly to end impersonation
fetch('https://automate-my-blog-backend.vercel.app/api/v1/admin/impersonate', {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => {
  console.log('API Response:', data);
  
  if (data.success) {
    console.log('✅ Impersonation ended on backend');
    
    // Step 2: Clear the impersonation token and force logout
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    
    console.log('✅ Tokens cleared');
    
    // Step 3: Reload page to reset auth state
    console.log('🔄 Reloading page to reset auth state...');
    window.location.reload();
    
  } else {
    console.error('❌ Failed to end impersonation:', data.message);
  }
})
.catch(error => {
  console.error('❌ Request failed:', error);
  
  // Emergency fallback: Just clear tokens and reload
  console.log('🚨 Emergency fallback: Clearing tokens and reloading...');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  window.location.reload();
});

console.log('📝 Copy and paste this script in your browser console if needed.');