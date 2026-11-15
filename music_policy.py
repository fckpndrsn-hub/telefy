"""Song-language filtering from metadata, not performer nationality.

Unknown language is not proof of Russian lyrics. This does not inspect audio.
"""
import os,re,unicodedata

def language_blocked(track):
    if not isinstance(track,dict):return False
    urn=str(track.get('soundcloudUrn') or track.get('urn') or '')
    denied={x.strip() for x in os.environ.get('TELEFY_BLOCKED_TRACK_URNS','').split(',') if x.strip()}
    if urn and urn in denied:return True
    for key in ('language','language_code','songLanguage','lyrics_language'):
        value=str(track.get(key) or '').strip().casefold().replace('_','-')
        if value and value.split('-')[0] not in ('ru','rus','russian','русский','en','eng','english','und','unknown'):return True
        if value in ('uk','ukr','ukrainian','українська','украинский') or value.startswith('uk-'):return True
    # Do not read the artist, user profile, city, country or photo into this classifier.
    tags=' '.join(str(track.get(k) or '') for k in ('genre','tag_list','tags'))
    if re.search(r'ukrainian|украинск|українськ',tags,re.I):return True
    text=unicodedata.normalize('NFKC',' '.join(str(track.get(k) or '') for k in ('title','lyrics'))).casefold()
    if re.search('[іїєґ\u0900-\u0dff\u0600-\u06ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]',text):return True
    if re.search(r'bollywood|bhangra|filmi|hindustani|carnatic',tags,re.I):return True
    return False
