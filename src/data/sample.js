// A deliberately messy PRACTICE dataset (synthetic numbers, not real records).
// It reproduces problems found in real public registries: title rows, footnotes,
// mixed number and date formats, spelling variants, duplicates and source notes.
export const SAMPLE_NAME = 'practice-relief-payments.csv'

export const SAMPLE_CSV = `PRACTICE DATASET - synthetic figures for training only,,,,,
Relief payments by district (illustrative),,,,,
,,,,,
District,Province,Month,Families reached,Amount disbursed (PKR),Status[1]
Dera Ghazi Khan,Punjab,Jan 2024,"1,240","Rs. 18,600,000",Completed
Rajanpur, punjab ,15/02/2024,980,Rs. 14.7 mn,Completed
Jacobabad,Sindh,2024-03-01,"2,105","31,575,000",In progress
Dadu,SINDH,Mar 2024,"1,870",28.05 mn,Completed
Larkana,Sindh,15/04/2024,n/a,"9,300,000",Pending
Nasirabad,Balochistan,Apr 2024,640,"9,600,000",Completed
Jaffarabad,balochistan,2024-05-10,710,10.65 mn,completed
Swat,Khyber Pakhtunkhwa,May 2024,"1,120","16,800,000",Completed
Nowshera,Khyber  Pakhtunkhwa,15/06/2024,"1,005",-,Pending
Dera Ghazi Khan,Punjab,Jun 2024,"1,310","19,650,000",Completed
Rajanpur,Punjab,Jul 2024,"1,050",15.75 mn,In progress
District,Province,Month,Families reached,Amount disbursed (PKR),Status[1]
Jacobabad,Sindh,Jul 2024,"2,240",33.6 mn,Completed
Dadu,Sindh,2024-08-05,"1,930","28,950,000",Completed
Dadu,Sindh,2024-08-05,"1,930","28,950,000",Completed
Nasirabad,Balochistan,Aug 2024,700,"10,500,000",In progress
Swat,Khyber Pakhtunkhwa,Sep 2024,"1,180",17.7 mn,Completed*
,,,,,
[1] Status as reported by the district office.,,,,,
Source: illustrative practice data created for this tool.,,,,,`
