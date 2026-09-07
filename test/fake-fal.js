export function fakeFal(image,{onSubmit=()=>{},failAt=0}={}) {
  let count=0;const uploads=[];
  return {uploads,get count(){return count;},sleep:async()=>{},upload:async file=>{uploads.push(file);return `https://fal.media/ref${uploads.length}.png`;},fetch:async(url,options={})=>{
    if(options.method==='POST'){count++;onSubmit(JSON.parse(options.body),options);if(count===failAt)return new Response('SECRET',{status:429});return Response.json({request_id:`fake-${count}`,status_url:'https://queue.fal.run/fal-ai/flux-2/requests/fake/status',response_url:'https://queue.fal.run/fal-ai/flux-2/requests/fake'});}
    if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});
    if(url.startsWith('https://queue.fal.run/'))return Response.json({images:[{url:'https://fal.media/result.png'}],seed:123});
    if(url==='https://fal.media/result.png')return new Response(image);
    throw new Error('Unexpected network destination');
  }};
}
