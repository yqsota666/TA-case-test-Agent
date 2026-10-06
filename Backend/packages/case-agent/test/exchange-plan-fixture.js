export const exchangePlan={status:'READY',openQuestions:[],steps:[
  {stepId:'send03',roundId:'trade1',direction:'SEND',fileType:'03',businessTime:{kind:'DATE',value:'20261006'},required:true,dependsOn:[]},
  {stepId:'receive04',roundId:'trade1',direction:'RECEIVE',fileType:'04',businessTime:{kind:'DATE',value:'20261007'},required:true,dependsOn:[{stepId:'send03',condition:'SENT'}]},
]};
