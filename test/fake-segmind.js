// Stands in for a Segmind endpoint. Its endpoints are synchronous: a successful
// POST returns the image bytes, so there is no queue to fake.
export function fakeSegmind(image,{status=200,body=null,contentType='image/png',onSubmit=()=>{}}={}) {
  const calls=[];
  return {calls,get count(){return calls.length;},fetch:async(url,options={})=>{
    calls.push({url,headers:options.headers,input:JSON.parse(options.body)});
    onSubmit(calls[calls.length-1].input,options);
    if(status!==200)return typeof body==='string'
      ? new Response(body,{status,headers:{'content-type':'text/plain'}})
      : Response.json(body??{error:'failed'},{status});
    return new Response(image,{status:200,headers:{'content-type':contentType,'x-request-id':'seg-req-1'}});
  }};
}
