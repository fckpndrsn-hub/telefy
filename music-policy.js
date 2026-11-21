/* Metadata filter for saved browser catalogs as well as new API responses. */
window.telefySongBlocked=function(track){
 if(!track)return false;
 const codes=['language','language_code','songLanguage','lyrics_language'];
 if(codes.some(k=>{const v=String(track[k]||'').trim().toLowerCase().replace('_','-').split('-')[0];return v&&!['ru','rus','russian','русский','en','eng','english','und','unknown'].includes(v);}))return true;
 if(codes.some(k=>/^(uk(?:[-_].*)?|ukr|ukrainian|українська|украинский)$/i.test(String(track[k]||'').trim())))return true;
 const tags=[track.genre,track.tag_list,track.tags].filter(Boolean).join(' ');
 if(/ukrainian|украинск|українськ|bollywood|bhangra|filmi|hindustani|carnatic/i.test(tags))return true;
 return /[іїєґ\u0900-\u0dff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/iu.test([track.title,track.lyrics].filter(Boolean).join(' ').normalize('NFKC'));
};

window.TelefyPromotionExcluded=tr=>/(^|[^a-zа-яё])(?:баста|basta|ноггано|noggano|1.?клас|1.?kla[$sс]+|смоки[ ]*мо|smoky[ ]*mo|smokey[ ]*mo)(?=$|[^a-zа-яё])/i.test([tr?.artist,tr?.title].join(' '));

window.TelefyHardArtistAliases=["RMW", "рмв", "Anonymous Ember", "anonymous amber", "анонимный эмбер", "tuborosho", "туборошо", "huzzy b", "huzzyb", "хаззиб", "fckshiza", "факшиза", "FORTUNA 812", "fortune 812", "фортуна 812", "фортуна", "madk1d", "madkid", "медкид", "мэдкид", "темный принц", "тёмный принц", "Kai Angel", "кай ангел", "9mice", "9 mice", "Clout", "клаут", "klout", "CODE10", "code 10", "code80", "Nanmas", "нанмас", "fakemutin", "фейкмутин", "Олег Кавказ", "oleg kavkaz", "ivycraft", "айвикрафт", "Главный герой", "glavniy geroy", "хулагу 3g", "hulagu 3g", "hulagu3g", "3goth2002", "akiko!", "CODE80", "code 80", "greyrock", "грейрок", "tewiq", "тевик", "3umph", "PHARAOH", "Boulevard Depo", "ЛСП", "Markul", "OG Buda", "SODA LUV", "KIZARU", "Big Baby Tape", "Morgenshtern", "Kai Angel", "Mnogoznaal", "Jeembo", "TVETH", "BATO", "Miyagi", "PHARAOH", "Boulevard Depo", "FRIENDLY THUG 52 NGG", "Whole Lotta Swag", "Villian", "baby cute", "Toxi$"];
window.TelefyRapCandidate=function(tr){
 if(!tr||window.telefySongBlocked(tr)||window.TelefyPromotionExcluded(tr))return false;
 const genre=[tr.genre,tr.tag_list,tr.tags].filter(Boolean).join(' ');
 if(/rap|hip.?hop|trap|plugg|drill|rage|phonk|рэп|трэп/i.test(genre))return true;
 if(tr.classificationVersion===4&&tr.modes?.includes('night')&&!/rock|metal/i.test(genre))return true;
 if(genre.trim())return false;
 const norm=s=>' '+String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9$]+/g,' ').trim()+' ';
 const artist=norm(tr.primaryArtist||tr.artist);return window.TelefyHardArtistAliases.some(a=>artist.includes(norm(a)));
};

(()=>{
 const patterns=["\u0440\u043e\u0441\u0441\u0438[\u0430-\u044f]*", "\u0443\u043a\u0440\u0430\u0438\u043d[\u0430-\u044f]*", "\u043f\u0443\u0442\u0438\u043d[\u0430-\u044f]*", "\u0445\u0443\u0439\u043b[\u0430-\u044f]*", "\u043f\u0438\u0434\u043e\u0440[\u0430-\u044f]*", "\u043f\u0438\u0434\u0430\u0440[\u0430-\u044f]*", "russi[a-z]*", "rossi[a-z]*", "rossiy[a-z]*", "ukrain[a-z]*", "ukrayin[a-z]*", "putin[a-z]*", "khuylo[a-z]*", "huylo[a-z]*", "huilo[a-z]*", "pidor[a-z]*", "pidar[a-z]*"],match=new RegExp('^(?:'+patterns.join('|')+')$','u');
 const mapping=Object.fromEntries([...('abcehkmoptxy')].map((c,i)=>[c,[...('авсенкмортху')][i]]));
 function text(value){const tokens=String(value||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[\p{Cf}\p{M}]/gu,'').match(/[a-zа-я0-9]+/g)||[];return tokens.some(word=>{if(/[а-я]/.test(word))word=word.replace(/[abcehkmoptxy]/g,c=>mapping[c]);return match.test(word);});}
 function blocked(item){if(typeof item==='string')return text(item);return Boolean(item&&['title','artist','primaryArtist','album','name','displayName','username','album_title'].some(k=>text(item[k])));}
 window.TelefyContentPolicy={text,blocked};const before=window.telefySongBlocked;window.telefySongBlocked=tr=>blocked(tr)||Boolean(before?.(tr));
})();
