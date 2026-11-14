(function(root){
  // Contracted after the 2063 HS cycle. Northern Illinois remains; Toledo is cut.
  const contracted=Object.freeze([
    'San Jose State','Toledo','Tulsa','Nevada','North Dakota State',
    'South Dakota State','Florida Atlantic','Southern Mississippi','Grambling State','Arkansas State',
    'UNLV','Louisiana Tech','Tulane','Wyoming','Ohio','San Diego State',
    'Yale','Harvard','Princeton','Fresno State'
  ]);
  const key=value=>String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
  const keys=new Set(contracted.map(key));
  root.NZCFLTeamStatus=Object.freeze({contracted,isContracted:value=>keys.has(key(value))});
})(globalThis);
