import {create} from 'zustand';
type State={saved:string[];toggleSaved:(id:string)=>void};export const useAppStore=create<State>((set)=>({saved:[],toggleSaved:(id)=>set(s=>({saved:s.saved.includes(id)?s.saved.filter(x=>x!==id):[...s.saved,id]}))}));
