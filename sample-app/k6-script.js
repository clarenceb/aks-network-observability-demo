import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '5m', target: 20 },
    { duration: '20s', target: 0 },
  ],
};

export default function() {
  let res = http.get('http://localhost:9090/');
  check(res, { 'status was 200': r => r.status == 200 });
}
